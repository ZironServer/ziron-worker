/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {
    SocketOptions,
    Socket,
    BatchOption,
    SendTimeoutOption,
    CancelableOption,
    ComplexTypesOption, CancelablePromise, ResponseTimeoutOption, ReturnDataTypeOption, DataType
} from "ziron-client";
import {UnsubscribeReason} from "ziron-client/dist/lib/core/Socket";
import {hashToIndex, stringifyError, Writable} from "../Utils";
import {EMPTY_FUNCTION} from "../Constants";
import {NamedError} from "ziron-errors";

/**
 * Publishing in it with an acknowledgement confirms all earlier publishes of the socket
 * (the broker processes the messages of a socket in order). Nobody subscribes it.
 */
const BARRIER_CHANNEL = '#barrier';

/**
 * A socket of the pool with its publishes that the broker did not confirm yet.
 */
interface PoolClient {
    socket: Socket,
    /**
     * Channels published in since the last barrier was sent.
     */
    pending: Set<string>,
    /**
     * Channels published in before the barrier on its way.
     */
    confirming?: Set<string>,
    barrierScheduled: boolean
}

export interface BrokerClientPoolOptions {
    poolSize: number,
    uri: string,
    joinTokenSecret: string,
    clusterVersion: number,
}

export default class BrokerClientPool {

    readonly brokerId?: string;
    readonly destroyed: boolean = false;

    get brokerUri(): string {
        return this._options.uri;
    }

    /**
     * @internal
     */
    public onError: (err: Error) => void = EMPTY_FUNCTION;
    /**
     * @internal
     */
    public onPublish: (channel: string, data: any, complexDataType: boolean) => void = EMPTY_FUNCTION;
    /**
     * @internal
     * The subscription of a channel was confirmed (true) or cut (false).
     */
    public onSubscriptionChange: (channel: string, active: boolean) => void = EMPTY_FUNCTION;
    /**
     * @internal
     * A publish in the channel may not have reached the broker.
     */
    public onPublishLoss: (channel: string) => void = EMPTY_FUNCTION;

    private readonly _options: BrokerClientPoolOptions;
    private readonly clientOptions: SocketOptions;

    private clients: Socket[] = [];
    private poolClients: PoolClient[] = [];
    /**
     * The channels to subscribe, also while a subscribe is on its way or failed.
     */
    private readonly _channels: Set<string> = new Set();
    /**
     * The channels with a confirmed subscription that was not cut since.
     */
    private readonly _active: Set<string> = new Set();

    constructor(options: BrokerClientPoolOptions) {
        this._options = options;
        this.clientOptions = this._buildSocketOptions();
        if(this._options.poolSize < 1) throw new Error("Pool size must be greater than 0");
        this._fillPool();
    }

    private _fillPool() {
        const poolSize = this._options.poolSize;
        for(let i = 0; i < poolSize; i++) {
            const socket = new Socket({...this.clientOptions});
            const client: PoolClient = {socket, pending: new Set(), barrierScheduled: false};
            socket.on("error",this._handleClientError);
            socket.onPublish(this._handleClientPublish);
            socket.on("connect",(brokerId) => this._handleClientConnect(client,brokerId));
            socket.on("disconnect",() => this._reportUnconfirmed(client));
            socket.onSubscribe(this._handleSubscribe);
            socket.onUnsubscribe(this._handleUnsubscribe);
            socket.connect().catch(() => {})
            this.clients[i] = socket;
            this.poolClients[i] = client;
        }
    }

    private _selectClient(key: string): Socket {
        return this.clients[hashToIndex(key,this.clients.length)];
    }

    private _selectPoolClient(key: string): PoolClient {
        return this.poolClients[hashToIndex(key,this.poolClients.length)];
    }

    private _handleClientConnect(client: PoolClient, brokerId: string) {
        if(brokerId) (this as Writable<BrokerClientPool>).brokerId = brokerId;
        //subscribes that failed are not pending in the socket
        for(const channel of this._channels) {
            if(this._selectPoolClient(channel) === client && !client.socket.hasSubscribed(channel,true))
                this._subscribe(channel);
        }
    }

    private _handleSubscribe = (channel: string) => {
        if(!this._channels.has(channel)) {
            //unsubscribed while the subscribe was on its way
            this._selectClient(channel).unsubscribe(channel).catch(() => {});
            return;
        }
        if(this._active.has(channel)) return;
        this._active.add(channel);
        this.onSubscriptionChange(channel,true);
    }

    private _handleUnsubscribe = (channel: string, reason: UnsubscribeReason) => {
        if(reason === UnsubscribeReason.Client || !this._active.delete(channel)) return;
        this.onSubscriptionChange(channel,false);
        //a pending subscription is only renewed on a connect
        if(reason === UnsubscribeReason.KickOut) this._subscribe(channel);
    }

    /**
     * Publishes that the broker did not confirm before the connection broke may be lost.
     */
    private _reportUnconfirmed(client: PoolClient) {
        const channels = client.confirming ? new Set([...client.confirming,...client.pending]) : client.pending;
        client.confirming = undefined;
        client.pending = new Set();
        for(const channel of channels) this.onPublishLoss(channel);
    }

    private _scheduleBarrier(client: PoolClient) {
        if(client.barrierScheduled || client.confirming) return;
        client.barrierScheduled = true;
        setImmediate(() => this._sendBarrier(client));
    }

    private _sendBarrier(client: PoolClient) {
        client.barrierScheduled = false;
        if(client.confirming || client.pending.size === 0 || this.destroyed) return;
        const confirming = client.confirming = client.pending;
        client.pending = new Set();
        client.socket.publish(BARRIER_CHANNEL,undefined,{ack: true}).then(() => {
            if(client.confirming !== confirming) return;
            client.confirming = undefined;
            if(client.pending.size > 0) this._scheduleBarrier(client);
        },() => {
            //a disconnect reported them already
            if(client.confirming === confirming) this._reportUnconfirmed(client);
        });
    }

    private _handleClientError = (error: Error) => {
        this.onError(new NamedError("PoolClientError", error.stack));
    }

    private _handleClientPublish = (channel: string, data: any, complexDataType: boolean) => {
        this.onPublish(channel,data,complexDataType);
    }

    private _buildSocketOptions(): SocketOptions {
        return Object.assign(Socket.parseOptionsFromUrl(this._options.uri),{
            ackTimeout: 3000,
            connectTimeout: 3000,
            invokeSendTimeout: null,
            transmitSendTimeout: null,
            autoReconnect: {
                active: true,
                initialDelay: 1000,
                randomness: 1000,
                multiplier: 1,
                maxDelay: 2000,
            },
            handshakeAttachment: {
                secret: this._options.joinTokenSecret,
                clusterVersion: this._options.clusterVersion
            }
        } as SocketOptions);
    }

    /**
     * @internal
     * Stays until unsubscribe: a failed subscribe is repeated.
     */
    async subscribe(channel: string): Promise<void> {
        this._channels.add(channel);
        await this._subscribe(channel);
    }

    private async _subscribe(channel: string): Promise<void> {
        const socket = this._selectClient(channel);
        try {await socket.subscribe(channel);}
        catch (err) {
            //cut by a disconnect: repeated on the connect
            if(socket.isConnected() && !this.destroyed) setTimeout(() => {
                if(this._channels.has(channel) && !socket.hasSubscribed(channel,true)) this._subscribe(channel);
            },1000);
            this.onError(new NamedError("PoolClientSubscribeFail", stringifyError(err)));
        }
    }

    /**
     * @internal
     */
    async unsubscribe(channel: string): Promise<void> {
        this._channels.delete(channel);
        this._active.delete(channel);
        try {await this._selectClient(channel).unsubscribe(channel);}
        catch (err) {this.onError(new NamedError("PoolClientUnsubscribeFail", stringifyError(err)));}
    }

    /**
     * @internal
     * The broker confirms the publishes with one acknowledged barrier per round trip;
     * when the connection breaks before, onPublishLoss tells the channels.
     */
    async publish(channel: string, data: any, processComplexTypes: boolean) {
        const client = this._selectPoolClient(channel);
        client.pending.add(channel);
        this._scheduleBarrier(client);
        try {await client.socket.publish(channel,data,{processComplexTypes});}
        catch (err) {this.onError(new NamedError("PoolClientPublishFail", stringifyError(err)));}
    }

    /**
     * @description
     * Do custom invokes on a selected socket.
     * Be careful only to use custom procedures.
     * @param procedure
     * @param data
     * @param options
     */
    invoke<RDT extends true | false | undefined, C extends boolean | undefined = undefined>
    (procedure: string, data?: any, options: BatchOption & SendTimeoutOption & CancelableOption<C> &
        ResponseTimeoutOption & ComplexTypesOption & ReturnDataTypeOption<RDT> = {})
        : C extends true ? CancelablePromise<RDT extends true ? [any,DataType] : any> : Promise<RDT extends true ? [any,DataType] : any>
    { return this._selectClient(procedure).invoke(procedure,data,options); }

    /**
     * @description
     * Do custom transmits on a selected socket.
     * Be careful only to use custom receivers.
     * @param receiver
     * @param data
     * @param options
     */
    transmit<C extends boolean | undefined = undefined>
    (receiver: string, data?: any, options: BatchOption & SendTimeoutOption &
        CancelableOption<C> & ComplexTypesOption = {})
        : C extends true ? CancelablePromise<void> : Promise<void>
    { return this._selectClient(receiver).transmit(receiver,data,options); }

    getSubscriptions(includePending: boolean = false): string[] {
        return Array.from(includePending ? this._channels : this._active);
    }

    // noinspection JSUnusedGlobalSymbols
    hasSubscribed(channel: string,includePending: boolean = false): boolean {
        return includePending ? this._channels.has(channel) : this._active.has(channel);
    }

    /**
     * @description
     * Returns if any client of the pool is connected to the broker.
     */
    isConnected(): boolean {
        for(let i = 0, len = this.clients.length; i < len; i++)
            if(this.clients[i].isConnected()) return true;
        return false;
    }

    /**
     * @internal
     */
    destroy() {
        (this as Writable<BrokerClientPool>).destroyed = true;
        this._channels.clear();
        this._active.clear();
        const length = this.clients.length;
        let client: Socket;
        for(let i = 0; i < length; i++) {
            client = this.clients[i];
            client.off();
            client.removeAllChannelListener();
            client.unsubscribe();
            client.disconnect();
            //buffered or unconfirmed publishes do not reach the broker anymore
            this._reportUnconfirmed(this.poolClients[i]);
        }
    }
}
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
import {hashToIndex, stringifyError, Writable} from "../Utils";
import {EMPTY_FUNCTION} from "../Constants";
import {NamedError} from "ziron-errors";

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

    private readonly _options: BrokerClientPoolOptions;
    private readonly clientOptions: SocketOptions;

    private clients: Socket[] = [];

    constructor(options: BrokerClientPoolOptions) {
        this._options = options;
        this.clientOptions = this._buildSocketOptions();
        if(this._options.poolSize < 1) throw new Error("Pool size must be greater than 0");
        this._fillPool();
    }

    private _fillPool() {
        const poolSize = this._options.poolSize;
        let tempSocket: Socket;
        for(let i = 0; i < poolSize; i++) {
            tempSocket = new Socket({...this.clientOptions});
            tempSocket.on("error",this._handleClientError);
            tempSocket.onPublish(this._handleClientPublish);
            tempSocket.on("connect",this._handleClientConnect);
            tempSocket.connect().catch(() => {})
            this.clients[i] = tempSocket;
        }
    }

    private _selectClient(key: string): Socket {
        return this.clients[hashToIndex(key,this.clients.length)];
    }

    private _handleClientConnect = (brokerId: string) => {
        if(brokerId) (this as Writable<BrokerClientPool>).brokerId = brokerId;
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
     */
    async subscribe(channel: string): Promise<void> {
        try {await this._selectClient(channel).subscribe(channel);}
        catch (err) {this.onError(new NamedError("PoolClientSubscribeFail", stringifyError(err)));}
    }

    /**
     * @internal
     */
    async unsubscribe(channel: string): Promise<void> {
        try {return this._selectClient(channel).unsubscribe(channel);}
        catch (err) {this.onError(new NamedError("PoolClientUnsubscribeFail", stringifyError(err)));}
    }

    /**
     * @internal
     */
    async publish(channel: string, data: any, processComplexTypes: boolean) {
        try {await this._selectClient(channel).publish(channel,data,{processComplexTypes});}
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
        const subscriptions: string[] = [];
        for(let i = 0; i < this.clients.length; i++)
            subscriptions.push(...this.clients[i].getSubscriptions(includePending))
        return subscriptions;
    }

    // noinspection JSUnusedGlobalSymbols
    hasSubscribed(channel: string,includePending: boolean = false): boolean {
        return this._selectClient(channel).hasSubscribed(channel,includePending);
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
        const length = this.clients.length;
        let client: Socket;
        for(let i = 0; i < length; i++) {
            client = this.clients[i];
            client.unsubscribe();
            client.disconnect();
            client.off();
            client.removeAllChannelListener();
        }
    }
}
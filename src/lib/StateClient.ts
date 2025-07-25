/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {
    BatchOption,
    CancelableOption, CancelablePromise,
    ComplexTypesOption, DataType,
    ResponseTimeoutOption, ReturnDataTypeOption,
    SendTimeoutOption,
    Socket
} from "ziron-client";
import EventEmitter from "emitix";
import { address } from "ip";
import {arrayContentEquals, ensureError, Writable} from "./Utils";
import {CLUSTER_VERSION} from "./ClusterVersion";
import Timeout = NodeJS.Timeout;
import Logger from "./Logger";

type LocalEventEmitter = EventEmitter<{
    'leadershipChange': [boolean],
    'brokersChange': [string[]],
    'sessionIdChange': [string],
    'sessionSharedUpdate': [any,any],
    'error': [Error]
}>;

type BrokerUpdate = {
    time: number,
    uris: string[]
}

type JoinResponse = {
    session: {
        id: string,
        shared: any,
    },
    brokers: BrokerUpdate | null,
    leader: boolean
}

export default class StateClient {

    private readonly _localEmitter: LocalEventEmitter = new EventEmitter();
    public readonly once: LocalEventEmitter['once'] = this._localEmitter.once.bind(this._localEmitter);
    public readonly on: LocalEventEmitter['on'] = this._localEmitter.on.bind(this._localEmitter);
    public readonly off: LocalEventEmitter['off'] = this._localEmitter.off.bind(this._localEmitter);
    private readonly _emit: LocalEventEmitter['emit'] = this._localEmitter.emit.bind(this._localEmitter);

    private readonly _stateSocket: Socket;
    private _invokeJoinRetryTicker: Timeout;
    private _initJoinCalled: boolean = false;

    get connected(): boolean {
        return this._stateSocket?.isConnected();
    }

    readonly stateId?: string;

    private initJoined = false;

    private initJoinResolve: () => void;
    private initJoinReject: (err: Error) => void;
    public readonly initJoin: Promise<void> = new Promise((res, rej) => {
        this.initJoinResolve = res;
        this.initJoinReject = rej;
    })

    /**
     * @description
     * Do custom invokes with the state socket.
     * Be careful only to use custom procedures.
     * @param procedure
     * @param data
     * @param options
     */
    invoke<RDT extends true | false | undefined, C extends boolean | undefined = undefined>
    (procedure: Exclude<string,'#join' | '#leave'>, data?: any, options: BatchOption & SendTimeoutOption & CancelableOption<C> &
        ResponseTimeoutOption & ComplexTypesOption & ReturnDataTypeOption<RDT> = {})
        : C extends true ? CancelablePromise<RDT extends true ? [any,DataType] : any> : Promise<RDT extends true ? [any,DataType] : any>
    { return this._stateSocket.invoke(procedure,data,options); }

    /**
     * @description
     * Do custom transmits with the state socket.
     * Be careful only to use custom receivers.
     * @param receiver
     * @param data
     * @param options
     */
    transmit<C extends boolean | undefined = undefined>
    (receiver: string, data?: any, options: BatchOption & SendTimeoutOption &
        CancelableOption<C> & ComplexTypesOption = {})
        : C extends true ? CancelablePromise<void> : Promise<void>
    { return this._stateSocket.transmit(receiver,data,options); }

    public readonly sessionShared: Record<any,any> = {};
    public readonly clusterSessionId: string = '/';
    public readonly leader: boolean = false;
    public get brokers() {
        return this._currentBrokerUpdate.uris;
    }

    private _currentBrokerUpdate: BrokerUpdate = {time: -1, uris: []};

    private readonly _joinData: {shared: object, payload: object};

    constructor(private readonly options: {
        joinTokenUri: string,
        joinTokenSecret: string,
        sharedData: Record<any, any>,
        joinPayload: Record<any, any>,
        id: string,
        path: string,
        port: number
    }, private readonly _logger: Logger) {
        this._joinData = {
            shared: options.sharedData,
            payload: options.joinPayload
        };

        const stateSocket = new Socket(options.joinTokenUri, {
            responseTimeout: 3000,
            connectTimeout: 3000,
            autoReconnect: {
                active: true,
                initialDelay: 1000,
                randomness: 1000,
                multiplier: 1,
                maxDelay: 2000,
            },
            handshakeAttachment: {
                secret: options.joinTokenSecret,
                clusterVersion: CLUSTER_VERSION,
                node: {
                    id: options.id,
                    type: 0,
                    ip: address(),
                    port: options.port,
                    path: options.path,
                },
            },
        });
        stateSocket.on("error", (err) => {
            this._logger.logError("Error in state socket: " + err.stack);
            this._emit("error",new Error("Error in state socket: " + err.stack));
        });
        stateSocket.procedures.addLeadership = (_,end) => {
            this._updateLeadership(true);
            end();
        };
        stateSocket.receivers.updateBrokers = (brokersUpdate: BrokerUpdate) => {
            this._handleBrokerUpdate(brokersUpdate);
        }
        stateSocket.on("disconnect", () => {
            (this as Writable<StateClient>).stateId = undefined;
            this._updateLeadership(false);
        })

        const tryJoin = async () => {
            try {
                await this._invokeJoin();
                this._logger.logInfo(`Worker has ${this.initJoined ? "re" : ""}joined the cluster.`);
                this.initJoined = true;
                this.initJoinResolve();
            }
            catch (rawErr) {
                const err = ensureError(rawErr);
                this.initJoinReject(err);
                if(err.name === "IdAlreadyUsedInClusterError")
                    this._logger.logWarning(`Attempt to join the cluster failed, the server-id: "${this.options.id}" already exists in the cluster.`);
                else if(err.stack) this._logger.logError(`Attempt to join the cluster failed: ${err.stack}.`);

                if(!stateSocket.isConnected()) return;
                this._invokeJoinRetryTicker = setTimeout(tryJoin, 2000);
                this._emit("error",err);
            }
        };
        stateSocket.on("connect", (stateId: string) => {
            if(stateId) (this as Writable<StateClient>).stateId = stateId;
            clearTimeout(this._invokeJoinRetryTicker);
            tryJoin();
        });
        this._stateSocket = stateSocket;
    }

    private async _invokeJoin() {
        const joinResponse: JoinResponse = await this._stateSocket.invoke("#join",this._joinData);
        if(joinResponse.brokers != null) this._handleBrokerUpdate(joinResponse.brokers);
        this._updateClusterSessionId(joinResponse.session.id);
        this._updateClusterSessionShared(joinResponse.session.shared);
    }

    public async join() {
        if(this._initJoinCalled) throw new Error("Join should only be invoked once. " +
                "The server will automatically retry to rejoin the cluster in case of disconnection.");
        this._initJoinCalled = true;
        this._stateSocket.connect().catch((err) => {
            this.initJoinReject(err);
            this._logger.logError(`Attempt to join the cluster failed: ${err.stack}.`);
        });
        return this.initJoin;
    }

    private _handleBrokerUpdate(brokersUpdate: BrokerUpdate) {
        if(this._currentBrokerUpdate.time <= brokersUpdate.time) {
            const tempCurrentBrokerUpdate = this._currentBrokerUpdate;
            this._currentBrokerUpdate = brokersUpdate;
            if(!arrayContentEquals(tempCurrentBrokerUpdate.uris,this._currentBrokerUpdate.uris))
                this._emit("brokersChange",this._currentBrokerUpdate.uris);
        }
    }

    private _updateLeadership(state: boolean) {
        const temp = this.leader;
        (this as Writable<StateClient>).leader = state;
        if(temp !== this.leader) this._emit("leadershipChange",this.leader);
    }

    private _updateClusterSessionId(id: string) {
        const temp = this.clusterSessionId;
        (this as Writable<StateClient>).clusterSessionId = id;
        if(temp !== this.clusterSessionId) this._emit("sessionIdChange",this.clusterSessionId);
    }

    private _updateClusterSessionShared(shared: any) {
        const temp = this.sessionShared;
        (this as Writable<StateClient>).sessionShared = shared;
        this._emit("sessionSharedUpdate",shared,temp);
    }

    /**
     * @internal
     */
    public terminate(): void {
        this._stateSocket.disconnect();
        clearTimeout(this._invokeJoinRetryTicker);
    }
}
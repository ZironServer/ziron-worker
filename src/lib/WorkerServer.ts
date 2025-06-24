/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import {WorkerServerOptions} from "./WorkerServerOptions";
import {deepEqual, ensureError, parseJoinToken} from "./Utils";
import StateClient from "./StateClient";
import BrokerClusterClient from "./externalBroker/BrokerClusterClient";
import {FailedToListenError, Server, Socket} from "ziron-server";
import BrokerClientPool from "./externalBroker/BrokerClientPool";
import Logger, {LogLevel} from "./Logger";

type ClusterShared = {
    payload?: Record<any,any>,
    auth?: {
        algorithm: string,
        privateKey: string,
        publicKey: string
    }
}

export default class WorkerServer<ES extends Socket = Socket>
    extends Server<{'sharedChange': [any],'leadershipChange': [boolean],'brokerClientsUpdate': []},ES>
{

    private readonly _rawJoinToken: string | null;
    private readonly brokerClusterClientMaxPoolSize: number;
    private readonly clusterJoinPayload: any;
    private readonly clusterShared: any;
    private readonly clusterShareAuth: boolean;

    public readonly joinToken: {secret: string, uri: string};
    public readonly stateClient?: StateClient;
    private readonly brokerClusterClient?: BrokerClusterClient;

    private readonly _logger: Logger;

    get leader(): boolean {
        return this.stateClient?.leader ?? false;
    }

    get shared(): any {
        return (this.stateClient?.sessionShared as ClusterShared | undefined)?.payload;
    }

    /**
     * @description
     * Provides limited access to the client pool for each broker.
     * Use it only when you know what you are doing.
     * Important: do not use any destroyed client pool
     * (can be checked with the destroyed property); otherwise, you risk a memory leak.
     */
    get brokerClients(): BrokerClientPool[] {
        return this.brokerClusterClient?.brokerClients ?? [];
    }

    constructor(options: WorkerServerOptions = {}) {
        super(options);

        this._logger = new Logger(options.logLevel ?? LogLevel.Everything);

        this._rawJoinToken = options.join || null;
        this.brokerClusterClientMaxPoolSize = options.brokerClusterClientMaxPoolSize || 12;
        this.clusterJoinPayload = options.clusterJoinPayload || {};
        this.clusterShared = options.clusterShared;
        this.clusterShareAuth = options.clusterShareAuth === undefined ? true : options.clusterShareAuth;

        this.joinToken = parseJoinToken(this._rawJoinToken || '');

        this.stateClient = this._setUpStateClient();
        this.stateClient?.on("sessionSharedUpdate", (shared: ClusterShared,
                                                     oldShared: ClusterShared) =>
        {
            if(!deepEqual(shared.payload,oldShared.payload))
                this.emitter.emit("sharedChange", shared.payload);

            if(this.clusterShareAuth && shared.auth && !deepEqual(shared.auth,oldShared.auth)){
                const auth = shared.auth;
                try {
                    this.auth.updateOptions({
                        algorithm: auth.algorithm as any,
                        publicKey: auth.publicKey,
                        privateKey: auth.privateKey
                    })
                }
                catch (err) {this.emitter.emit("error",ensureError(err));}
            }
        });
        this.stateClient?.on("leadershipChange",leader => {
            this.emitter.emit("leadershipChange",leader);
        });
        if(this.stateClient != null) {
            this.brokerClusterClient = new BrokerClusterClient(this.stateClient,this.internalBroker,{
                joinTokenSecret: this.joinToken.secret,
                maxClientPoolSize: this.brokerClusterClientMaxPoolSize
            });
            this.brokerClusterClient.on("brokerClientPoolsUpdate",() =>
                this.emitter.emit("brokerClientsUpdate"));
            this.internalBroker.externalBrokerClient = this.brokerClusterClient;
        }
    }

    isConnectedToState(): boolean {
        return !!this.stateClient?.connected;
    }

    public async join() {
        if(this._rawJoinToken == null) throw new Error("Join token was not provided.");
        return this.stateClient?.join();
    }

    public async listen() {
        if(super.isListening()) return;
        try {
            this._logger.logBusy("Launching worker server...");
            await super.listen();
            this._logger.logActive(`Worker server launched successfully on port: ${this.port}.`);
        }
        catch (err) {
            if(err instanceof FailedToListenError)
                this._logger.logFailed(`Failed to listen on port: ${this.port}. Maybe the port is already in use.`);
            throw err;
        }
    }

    public async joinAndListen() {
        await this.join();
        await this.listen();
    }

    private _setUpStateClient() {
        if(this._rawJoinToken == null) return undefined;
        const authOptions = this.auth.options;
        return new StateClient({
            id: this.id,
            port: this.port,
            path: this.path,
            joinTokenUri: this.joinToken.uri,
            joinTokenSecret: this.joinToken.secret,
            joinPayload: this.clusterJoinPayload,
            sharedData: {
                payload: this.clusterShared,
                auth: this.clusterShareAuth ? {
                    algorithm: authOptions.algorithm,
                    publicKey: authOptions.publicKey,
                    privateKey: authOptions.privateKey
                } : undefined
            } as ClusterShared
        },this._logger);
    }

    /**
     * Terminates the worker.
     * After termination, you should not use this instance anymore
     * or anything else from the worker.
     * [Use this method only when you know what you do.]
     */
    terminate() {
        super.terminate();
        this.stateClient?.terminate();
    }
}
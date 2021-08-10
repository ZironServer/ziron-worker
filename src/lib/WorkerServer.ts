/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import {WorkerServerOptions} from "./WorkerServerOptions";
import {parseJoinToken} from "./Utils";
import StateClient from "./StateClient";
import BrokerClusterClient from "./externalBroker/BrokerClusterClient";
import {Server} from "ziron-server";

type ClusterShared = {
    payload: Record<any,any>,
    auth: {
        algorithm: string,
        privateKey: string,
        publicKey: string
    }
}

export default class WorkerServer extends Server<{'sharedUpdate': [Record<any, any>]}> {

    private readonly join: string | null;
    private readonly brokerClusterClientMaxPoolSize: number;

    public readonly joinToken: {secret: string, uri: string};
    public readonly stateClientConnection?: Promise<void>;
    public readonly stateClient?: StateClient;

    get leader(): boolean {
        return this.stateClient?.leader ?? false;
    }

    get shared(): any {
        return (this.stateClient?.sessionShared as ClusterShared | undefined)?.payload;
    }

    constructor(options: WorkerServerOptions = {}) {
        super(options);

        this.join = options.join || null;
        this.brokerClusterClientMaxPoolSize = options.brokerClusterClientMaxPoolSize || 12;

        this.joinToken = parseJoinToken(this.join || '');

        this.stateClient = this._setUpStateClient();
        this.stateClient?.on("sessionSharedChange", (shared: ClusterShared) => {
            this.emitter.emit("sharedUpdate", shared.payload);
            const auth = shared.auth;
            try {
                this.auth.updateOptions({
                    algorithm: auth.algorithm as any,
                    publicKey: auth.publicKey,
                    privateKey: auth.privateKey
                })
            }
            catch (err) {this.emitter.emit("error",err);}
        })
        if(this.stateClient != null) this.stateClientConnection = this.stateClient.connect();

        if(this.stateClient != null) {
            this.internalBroker.externalBrokerClient = new BrokerClusterClient(this.stateClient,this.internalBroker,{
                joinTokenSecret: this.joinToken.secret,
                maxClientPoolSize: this.brokerClusterClientMaxPoolSize
            });
        }
    }

    private _setUpStateClient() {
        if(this.join == null) return undefined;
        const authOptions = this.auth.options;
        return new StateClient({
            id: this.options.id,
            port: this.options.port,
            path: this.options.path,
            joinTokenUri: this.joinToken.uri,
            joinTokenSecret: this.joinToken.secret,
            joinPayload: this.options.clusterJoinPayload || {},
            sharedData: {
                payload: this.options.clusterShared,
                auth: {
                    algorithm: authOptions.algorithm,
                    publicKey: authOptions.publicKey,
                    privateKey: authOptions.privateKey
                }
            } as ClusterShared
        });
    }

    /**
     * Terminates the worker.
     * After termination, you should not use this instance anymore
     * or anything else from the worker.
     * [Use this method only when you know what you do.]
     */
    terminate() {
        super.terminate();
        this.stateClient?.disconnect();
    }
}
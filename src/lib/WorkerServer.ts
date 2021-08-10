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

export default class WorkerServer extends Server {

    private readonly join: string | null;
    private readonly brokerClusterClientMaxPoolSize: number;

    public readonly joinToken: {secret: string, uri: string};
    public readonly stateClientConnection?: Promise<void>;
    public readonly stateClient?: StateClient;

    get leader(): boolean {
        return this.stateClient?.leader ?? false;
    }

    constructor(options: WorkerServerOptions = {}) {
        super(options);

        this.join = options.join || null;
        this.brokerClusterClientMaxPoolSize = options.brokerClusterClientMaxPoolSize || 12;

        this.joinToken = parseJoinToken(this.join || '');

        this.stateClient = this._setUpStateClient();
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
        return new StateClient({
            id: this.options.id,
            port: this.options.port,
            path: this.options.path,
            joinTokenUri: this.joinToken.uri,
            joinTokenSecret: this.joinToken.secret,
            joinPayload: this.options.clusterJoinPayload,
            sharedData: this.options.clusterShared
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
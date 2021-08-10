/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import {ServerOptions} from "ziron-server";

export type WorkerServerOptions = {
    /**
     * @description
     * Specifies the join token to the cluster.
     * This is required if you want to run a cluster.
     */
    join?: string | null;
    /**
     * Defines the max size of clients to a broker instance.
     * The concrete max size is determined with the count of broker instances.
     * @default 12
     */
    brokerClusterClientMaxPoolSize?: number;
    /**
     * Defines payload that will be sent to the state server when a connection will be created.
     * @default {}
     */
    clusterJoinPayload?: any;
    /**
     * Defines an object that can be shared with all workers via the state server.
     * Notice, only the shared object from the first worker in the cluster will be actively used and shared.
     * It can be helpful to sync a secret between all workers.
     * @default undefined
     */
    clusterShared?: any;
} & ServerOptions
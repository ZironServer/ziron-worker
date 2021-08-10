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
} & ServerOptions
/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

import WorkerServer              from "./lib/WorkerServer";
import {WorkerServerOptions}     from "./lib/WorkerServerOptions";
import EventEmitter              from "emitix";
import {TimeoutError, Transport} from "ziron-engine";
import StateClient               from "./lib/StateClient";
import {
    AuthEngine, Block, ChannelExchange,
    Procedure, Receiver,
    StandaloneProcedure, StandaloneReceiver,
    applyStandaloneProcedures, applyStandaloneReceivers,
    ProcedureEnd, ProcedureReject,
    Socket, FailedToListenError,
    AuthTokenExpiredError,
    AuthTokenInvalidError,
    AuthTokenError,
    AuthTokenNotBeforeError,
    UpgradeRequest,
    HttpRequest,
    HttpResponse,
    TLSOptions, CompressionOptions,
    Compressor, StaticFilesRouter
} from "ziron-server";
import BrokerClientPool from "./lib/externalBroker/BrokerClientPool";
import {LogLevel} from "./lib/Logger";

EventEmitter.onceTimeoutErrorCreator = () => new TimeoutError('Once timeout reached.','OnceListener');
const prepareMultiTransmit = Transport.prepareMultiTransmit;

export * from 'ziron-engine';
export {
    WorkerServer as Server,
    WorkerServerOptions as ServerOptions,
    TLSOptions,
    CompressionOptions,
    Compressor,
    prepareMultiTransmit,
    Socket,
    AuthEngine,
    ChannelExchange,
    Block,
    Procedure,
    ProcedureEnd,
    ProcedureReject,
    Receiver,
    StandaloneProcedure,
    StandaloneReceiver,
    applyStandaloneProcedures,
    applyStandaloneReceivers,
    StateClient,
    FailedToListenError,
    AuthTokenExpiredError,
    AuthTokenInvalidError,
    AuthTokenError,
    AuthTokenNotBeforeError,
    UpgradeRequest,
    HttpRequest,
    HttpResponse,
    StaticFilesRouter,
    BrokerClientPool,
    LogLevel
}
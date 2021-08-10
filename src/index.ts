/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import WorkerServer              from "./lib/WorkerServer";
import {WorkerServerOptions}     from "./lib/WorkerServerOptions";
import EventEmitter              from "emitix";
import {TimeoutError, Transport} from "ziron-engine";
import {AuthEngine, Block, Exchange,
    ProcedureListener, ReceiverListener, Socket} from "ziron-server";

EventEmitter.onceTimeoutErrorCreator = () => new TimeoutError('Once timeout reached.','OnceListener');
const prepareMultiTransmit = Transport.prepareMultiTransmit;

export * from 'ziron-engine';
export {
    WorkerServer as Server,
    WorkerServerOptions as ServerOptions,
    prepareMultiTransmit,
    Socket,
    AuthEngine,
    Exchange,
    Block,
    ProcedureListener,
    ReceiverListener
}
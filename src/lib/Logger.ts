/*
Author: Ing. Luca Gian Scaringella
GitHub: LucaCode
Copyright(c) Ing. Luca Gian Scaringella
 */

export enum LogLevel {
  Nothing,
  Errors,
  ErrorsAndWarnings,
  Everything,
}

export default class Logger {
  constructor(private readonly level: LogLevel) {}

  public logBusy(...msg: string[]) {
    if (this.level >= LogLevel.Everything)
      console.log("\x1b[33m%s\x1b[0m", "   [BUSY]", msg.join("\n"));
  }

  public logActive(...msg: string[]) {
    if (this.level >= LogLevel.Everything)
      console.log("\x1b[32m%s\x1b[0m", "   [ACTIVE]", msg.join("\n"));
  }

  public logInfo(...msg: string[]) {
    if (this.level >= LogLevel.Everything)
      console.log("\x1b[36m%s\x1b[0m", "   [INFO]", msg.join("\n"));
  }

  public logError(...msg: string[]) {
    if (this.level >= LogLevel.Errors)
      console.error("\x1b[31m%s\x1b[0m", "   [Error]", msg.join("\n"));
  }

  public logWarning(...msg: string[]) {
    if (this.level >= LogLevel.ErrorsAndWarnings)
      console.warn("\x1b[31m%s\x1b[0m", "   [WARNING]", msg.join("\n"));
  }
}
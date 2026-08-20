import type { Pool, RowDataPacket } from "mysql2/promise";
import type { CrmRepository } from "../types.js";

export type DbRow = RowDataPacket & Record<string, unknown>;

export type MysqlQueryExecutor = Pick<Pool, "query">;

export interface MysqlRepositoryExecutorOptions {
  transactional?: boolean;
  close?: () => Promise<void>;
  withTransaction?: <T>(work: (repository: CrmRepository) => Promise<T>) => Promise<T>;
}

export interface MysqlRepositoryFactoryContext {
  executor: MysqlQueryExecutor;
  options: MysqlRepositoryExecutorOptions;
}

export type MysqlRepositoryMethods = Partial<CrmRepository> & ThisType<CrmRepository>;

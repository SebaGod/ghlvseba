import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      res.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({
        code: 'http_error',
        message: exception.message,
      });
      return;
    }

    this.logger.error(exception);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ code: 'internal_error', message: 'Internal server error' });
  }
}

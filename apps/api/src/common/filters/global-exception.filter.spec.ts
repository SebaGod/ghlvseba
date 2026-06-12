import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppException, GlobalExceptionFilter } from './global-exception.filter';

function createHost() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  it('maps unknown throws to a 500 internal_error shape', () => {
    const { host, status, json } = createHost();
    filter.catch({ some: 'object' }, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      code: 'internal_error',
      message: 'Internal server error',
    });
  });

  it('maps plain HttpException to http_error with its status', () => {
    const { host, status, json } = createHost();
    filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ code: 'http_error', message: 'Not Found' });
  });

  it('includes details when AppException provides them', () => {
    const { host, status, json } = createHost();
    filter.catch(
      new AppException('invalid_input', 'Bad data', HttpStatus.BAD_REQUEST, { field: 'email' }),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'invalid_input',
      message: 'Bad data',
      details: { field: 'email' },
    });
  });
});

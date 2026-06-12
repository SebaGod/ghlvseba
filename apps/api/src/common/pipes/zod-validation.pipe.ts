import { HttpStatus, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { AppException } from '../filters/global-exception.filter';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        'validation_error',
        'Invalid request payload',
        HttpStatus.BAD_REQUEST,
        result.error.flatten().fieldErrors,
      );
    }
    return result.data;
  }
}

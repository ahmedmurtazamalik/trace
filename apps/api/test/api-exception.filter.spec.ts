import { type ArgumentsHost, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';

import { ApiExceptionFilter } from '../src/common/errors/api-exception.filter';

function createHttpHost() {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const request = {
    requestId: 'request-123',
    header: jest.fn().mockReturnValue(undefined),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('ApiExceptionFilter', () => {
  it('replaces arbitrary internal exception messages with a generic response', () => {
    const { host, response } = createHttpHost();
    const exception = new InternalServerErrorException({
      code: 'DATABASE_ERROR',
      message: 'postgresql://trace:secret@private-host/trace',
    });

    new ApiExceptionFilter().catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An internal server error occurred.',
      requestId: 'request-123',
    });
  });

  it('allows only the fixed public dependency-unavailable message', () => {
    const { host, response } = createHttpHost();
    const exception = new ServiceUnavailableException({
      code: 'DEPENDENCIES_UNAVAILABLE',
      message: 'attacker-controlled text',
    });

    new ApiExceptionFilter().catch(exception, host);

    expect(response.json).toHaveBeenCalledWith({
      code: 'DEPENDENCIES_UNAVAILABLE',
      message: 'Required dependencies are unavailable.',
      requestId: 'request-123',
    });
  });
});

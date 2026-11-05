import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('Health & Routing Endpoints', () => {
  it('GET /api/v1/health should return 200 with healthy status', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      service: 'urja-meter-api',
      status: 'healthy',
    });
  });

  it('GET /api/v1/unknown should return 404 with standardized error response', async () => {
    const response = await request(app)
      .get('/api/v1/unknown')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: expect.stringContaining('Route not found'),
      },
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Autenticación (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / es público y no requiere token', () => {
    return request(app.getHttpServer()).get('/').expect(200);
  });

  it('GET /listas sin token responde 401', () => {
    return request(app.getHttpServer()).get('/listas').expect(401);
  });

  it('GET /categorias con token malformado responde 401', () => {
    return request(app.getHttpServer())
      .get('/categorias')
      .set('Authorization', 'Bearer token-que-no-es-un-jwt')
      .expect(401);
  });

  it('GET /recordatorios con header Authorization sin Bearer responde 401', () => {
    return request(app.getHttpServer())
      .get('/recordatorios')
      .set('Authorization', 'token-sin-bearer')
      .expect(401);
  });
});

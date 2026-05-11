jest.mock('../services/seoUrlEnumerator', () => ({
  enumerateSeoUrls: () => ['/', '/airport/jfk', '/airline/ba', '/routes/jfk-lhr'],
  STATIC_PATHS: ['/'],
}));

const express = require('express');
const request = require('supertest');
const seoRouter = require('../routes/seo');

const app = express().use('/', seoRouter);

test('/airport/ entries have monthly changefreq + priority 0.6', async () => {
  const res = await request(app).get('/sitemap.xml');
  expect(res.status).toBe(200);
  const m = res.text.match(/<loc>https:\/\/himaxym\.com\/airport\/jfk<\/loc>[^<]*<lastmod>[^<]+<\/lastmod><changefreq>(\w+)<\/changefreq><priority>([\d.]+)<\/priority>/);
  expect(m).not.toBeNull();
  expect(m[1]).toBe('monthly');
  expect(m[2]).toBe('0.6');
});

test('/airline/ entries have monthly changefreq + priority 0.6', async () => {
  const res = await request(app).get('/sitemap.xml');
  const m = res.text.match(/<loc>https:\/\/himaxym\.com\/airline\/ba<\/loc>[^<]*<lastmod>[^<]+<\/lastmod><changefreq>(\w+)<\/changefreq><priority>([\d.]+)<\/priority>/);
  expect(m).not.toBeNull();
  expect(m[1]).toBe('monthly');
  expect(m[2]).toBe('0.6');
});

import { ConfiguredReportProvider, reportProviderFromEnvironment } from '../../src/reports/configured-report-provider';
import type { ReportInputSnapshot } from '../../src/reports/report-provider';

const snapshot: ReportInputSnapshot = {
  version: 1,
  reportDate: '2026-08-13',
  timezone: 'UTC',
  facts: { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 },
  repositories: [],
};

const validContent = { executiveSummary: 'No development commits were recorded.', repositories: [] };

describe('configured structured report provider', () => {
  it('posts a bounded structured-output request and parses only the JSON content', async () => {
    const fetchImplementation = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validContent) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new ConfiguredReportProvider({
      endpoint: 'https://llm.example.test/v1/chat/completions',
      apiKey: 'test-api-key',
      model: 'structured-model',
      timeoutMs: 1_000,
      allowedHosts: new Set(['llm.example.test']),
      fetchImplementation,
    });

    await expect(provider.generate(snapshot)).resolves.toEqual(validContent);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe('https://llm.example.test/v1/chat/completions');
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer test-api-key' });
    expect(typeof request?.body).toBe('string');
    expect(JSON.parse(request?.body as string)).toMatchObject({
      model: 'structured-model',
      response_format: { type: 'json_object' },
      temperature: 0,
    });
  });

  it('aliases internal identifiers before disclosure and restores them after response parsing', async () => {
    const sensitiveSnapshot: ReportInputSnapshot = {
      version: 1,
      reportDate: '2026-08-13',
      timezone: 'UTC',
      facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 1, additions: 2, deletions: 1 },
      repositories: [{
        id: 'internal-repository-id',
        fullName: 'private-owner/private-repository',
        facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 1, additions: 2, deletions: 1 },
        contributors: [{
          id: 'internal-contributor-id', username: 'developer', displayName: 'Developer',
          facts: { repositoryCount: 1, contributorCount: 1, commitCount: 1, filesChanged: 1, additions: 2, deletions: 1 },
        }],
        evidence: [{
          activityId: 'internal-activity-id', occurredAt: '2026-08-13T10:00:00.000Z', type: 'commit',
          sha: 'a'.repeat(40), message: 'Implement private feature',
        }],
      }],
    };
    let outboundBody = '';
    const fetchImplementation = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation((_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a serialized provider request body.');
      outboundBody = init.body;
      const request = JSON.parse(outboundBody) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(request.messages[1]!.content) as { requiredContent: unknown };
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(prompt.requiredContent) } }],
      }), { status: 200 }));
    });
    const provider = new ConfiguredReportProvider({
      endpoint: 'https://llm.example.test/v1/chat/completions', apiKey: 'test-api-key', model: 'model',
      allowedHosts: new Set(['llm.example.test']), fetchImplementation,
    });

    const output = await provider.generate(sensitiveSnapshot) as { repositories: Array<{ repositoryId: string; contributors: Array<{ contributorId: string }> }> };
    expect(output.repositories[0]).toMatchObject({
      repositoryId: 'internal-repository-id',
      contributors: [{ contributorId: 'internal-contributor-id' }],
    });
    expect(outboundBody).not.toContain('internal-repository-id');
    expect(outboundBody).not.toContain('internal-contributor-id');
    expect(outboundBody).not.toContain('internal-activity-id');
    expect(outboundBody).not.toContain('a'.repeat(40));
    expect(outboundBody).toContain('private-owner/private-repository');
    expect(outboundBody).toContain('Implement private feature');
  });

  it('uses the deterministic fake explicitly and rejects incomplete configured-provider settings', () => {
    expect(reportProviderFromEnvironment({ REPORT_LLM_PROVIDER: 'fake' }).constructor.name).toBe('DeterministicReportProvider');
    expect(() => reportProviderFromEnvironment({ REPORT_LLM_PROVIDER: 'configured' })).toThrow('Invalid report provider configuration.');
  });

  it('returns closed errors for provider HTTP failures, oversized responses, and invalid envelopes', async () => {
    const cases = [
      new Response('provider secret', { status: 429 }),
      new Response('x'.repeat(1_000), { status: 200 }),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ];
    for (const response of cases) {
      const provider = new ConfiguredReportProvider({
        endpoint: 'https://llm.example.test/v1/chat/completions',
        apiKey: 'test-api-key',
        model: 'structured-model',
        maximumResponseBytes: 100,
        allowedHosts: new Set(['llm.example.test']),
        fetchImplementation: jest.fn().mockResolvedValue(response),
      });
      await expect(provider.generate(snapshot)).rejects.toThrow('REPORT_PROVIDER_');
    }
  });

  it('rejects private endpoints, redirects, and oversized outbound snapshots', async () => {
    expect(() => new ConfiguredReportProvider({
      endpoint: 'https://127.0.0.1/v1/chat/completions', apiKey: 'key', model: 'model',
    })).toThrow('Invalid report provider configuration.');
    const redirectFetch = jest.fn().mockResolvedValue(new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    const provider = new ConfiguredReportProvider({
      endpoint: 'https://llm.example.test/v1/chat/completions', apiKey: 'key', model: 'model',
      maximumRequestBytes: 10_000, fetchImplementation: redirectFetch,
      allowedHosts: new Set(['llm.example.test']),
    });
    await expect(provider.generate(snapshot)).rejects.toThrow('REPORT_PROVIDER_FAILED');
    const redirectCall = redirectFetch.mock.calls.at(0) as [string, RequestInit] | undefined;
    expect(redirectCall?.[1]).toMatchObject({ redirect: 'error' });

    const boundedFetch = jest.fn();
    const bounded = new ConfiguredReportProvider({
      endpoint: 'https://llm.example.test/v1/chat/completions', apiKey: 'key', model: 'model',
      maximumRequestBytes: 100, fetchImplementation: boundedFetch,
      allowedHosts: new Set(['llm.example.test']),
    });
    await expect(bounded.generate(snapshot)).rejects.toThrow('REPORT_PROVIDER_REQUEST_TOO_LARGE');
    expect(boundedFetch).not.toHaveBeenCalled();
  });
});

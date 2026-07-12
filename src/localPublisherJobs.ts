import { createHash, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { localPublisherJobs, type LocalPublisherJobDoc } from './db';
import { authenticateLocalPublisher } from './localPublisherAgents';

const LEASE_MS = 60_000;

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export async function enqueueLocalPublisherJob(input: {
    accountId: string;
    platform: 'threads' | 'x';
    operation: 'publish' | 'delete';
    payload: Record<string, unknown>;
}): Promise<string> {
    const now = new Date();
    const doc: LocalPublisherJobDoc = {
        ...input,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
    };
    const result = await localPublisherJobs().insertOne(doc);
    return result.insertedId.toString();
}

export async function claimLocalPublisherJob(token: string): Promise<
    | {
          id: string;
          platform: 'threads' | 'x';
          operation: 'publish' | 'delete';
          payload: Record<string, unknown>;
          leaseToken: string;
          leaseExpiresAt: string;
      }
    | null
> {
    const agent = await authenticateLocalPublisher(token);
    if (!agent) throw new Error('Invalid local publisher token');
    if (!agent.platforms.length) return null;
    const supportedPlatforms = agent.platforms.filter(
        (platform): platform is 'threads' | 'x' =>
            platform === 'threads' || platform === 'x',
    );
    if (!supportedPlatforms.length) return null;

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const leaseToken = randomBytes(24).toString('base64url');
    const job = await localPublisherJobs().findOneAndUpdate(
        {
            accountId: agent.accountId,
            platform: { $in: supportedPlatforms },
            $or: [
                { status: 'queued' },
                { status: 'leased', leaseExpiresAt: { $lte: now } },
            ],
        },
        {
            $set: {
                status: 'leased',
                agentId: agent._id!.toString(),
                leaseTokenHash: hash(leaseToken),
                leaseExpiresAt,
                updatedAt: now,
            },
            $unset: { error: '', result: '' },
        },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
    );
    if (!job) return null;
    return {
        id: job._id!.toString(),
        platform: job.platform,
        operation: job.operation,
        payload: job.payload,
        leaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
    };
}

export async function completeLocalPublisherJob(
    token: string,
    jobId: string,
    input: {
        leaseToken?: unknown;
        ok?: unknown;
        result?: unknown;
        error?: unknown;
    },
): Promise<boolean> {
    const agent = await authenticateLocalPublisher(token);
    if (!agent || !ObjectId.isValid(jobId)) return false;
    const leaseToken = String(input.leaseToken ?? '');
    if (!leaseToken) return false;
    const ok = input.ok === true;
    const result = await localPublisherJobs().updateOne(
        {
            _id: new ObjectId(jobId),
            accountId: agent.accountId,
            agentId: agent._id!.toString(),
            status: 'leased',
            leaseTokenHash: hash(leaseToken),
        },
        {
            $set: {
                status: ok ? 'completed' : 'failed',
                ...(ok
                    ? {
                          result:
                              input.result && typeof input.result === 'object'
                                  ? (input.result as Record<string, unknown>)
                                  : {},
                      }
                    : { error: String(input.error || 'Local publish failed') }),
                updatedAt: new Date(),
            },
            $unset: {
                leaseTokenHash: '',
                leaseExpiresAt: '',
            },
        },
    );
    return result.modifiedCount > 0;
}

export async function waitForLocalPublisherJob(
    accountId: string,
    jobId: string,
    timeoutMs = 55_000,
): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const job = ObjectId.isValid(jobId)
            ? await localPublisherJobs().findOne({
                  _id: new ObjectId(jobId),
                  accountId,
              })
            : null;
        if (!job) throw new Error('Local publisher job was not found');
        if (job.status === 'completed') return job.result ?? {};
        if (job.status === 'failed') {
            throw new Error(job.error || 'Local publish failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Local publisher did not complete the job in time');
}

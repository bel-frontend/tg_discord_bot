import type { MemberPermissions } from './db';
import { AuthError, type ActorContext } from './auth';

/** Throws 403 unless the actor is the account owner or has the given permission. */
export function assertPermission(
    actor: ActorContext,
    perm: keyof MemberPermissions,
): void {
    if (actor.role === 'owner') return;
    if (!actor.permissions[perm]) {
        throw new AuthError('You do not have permission to do this', 403);
    }
}

/**
 * Throws 403 unless every target channel is within the actor's channelAccess.
 * `resourceIdByTarget` maps "platform:channelId" -> channelResource id; targets
 * with no entry (e.g. platform-discovered channels never added as a Resource)
 * are treated as inaccessible to a restricted member.
 */
export function assertChannelAccess(
    actor: ActorContext,
    targets: { platform: string; channelId: string }[],
    resourceIdByTarget: Map<string, string>,
): void {
    if (actor.role === 'owner') return;
    const access = actor.permissions.channelAccess;
    if (access === 'all') return;
    const allowed = new Set(access);
    for (const target of targets) {
        const resourceId = resourceIdByTarget.get(`${target.platform}:${target.channelId}`);
        if (!resourceId || !allowed.has(resourceId)) {
            throw new AuthError(
                'You do not have access to one or more selected channels',
                403,
            );
        }
    }
}

/**
 * A member granting/editing permissions can never hand out more than they
 * themselves have — otherwise a canManageMembers member could self-escalate
 * by inviting someone with broader access.
 */
export function assertPermissionsWithinGrantor(
    grantor: ActorContext,
    requested: MemberPermissions,
): void {
    if (grantor.role === 'owner') return;
    const grantorAccess = grantor.permissions.channelAccess;
    if (grantorAccess !== 'all') {
        const allowed = new Set(grantorAccess);
        const requestsAll =
            requested.channelAccess === 'all' ||
            requested.channelAccess.some((id) => !allowed.has(id));
        if (requestsAll) {
            throw new AuthError(
                'Cannot grant access to channels you cannot access yourself',
                403,
            );
        }
    }
    const booleanPerms: (keyof MemberPermissions)[] = [
        'canPublish',
        'canDelete',
        'canManageChannels',
        'canManageMembers',
    ];
    for (const perm of booleanPerms) {
        if (requested[perm] && !grantor.permissions[perm]) {
            throw new AuthError(
                `Cannot grant a permission ("${perm}") you do not have yourself`,
                403,
            );
        }
    }
}

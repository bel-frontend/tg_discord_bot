import { Resend } from 'resend';

let client: Resend | null = null;

function getClient(): Resend | null {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return null;
    if (!client) client = new Resend(apiKey);
    return client;
}

function fromAddress(): string {
    return process.env.EMAIL_FROM || 'Composer <onboarding@resend.dev>';
}

/**
 * Sends via Resend; logs and swallows failures so callers never fail their own
 * operation on email trouble. `link` is logged when RESEND_API_KEY is unset so
 * the invite/verify flow stays testable in local dev without a real provider.
 */
async function send(
    to: string,
    subject: string,
    html: string,
    link: string,
): Promise<void> {
    const resend = getClient();
    if (!resend) {
        console.warn(
            `RESEND_API_KEY is not set — skipping email "${subject}" to ${to}. Link: ${link}`,
        );
        return;
    }
    try {
        const { error } = await resend.emails.send({
            from: fromAddress(),
            to,
            subject,
            html,
        });
        if (error) console.error('Resend send failed:', error);
    } catch (error) {
        console.error('Resend send failed:', error);
    }
}

export async function sendInviteEmail(
    to: string,
    params: { inviteUrl: string; inviterEmail: string },
): Promise<void> {
    await send(
        to,
        `${params.inviterEmail} invited you to Composer`,
        `<p>${params.inviterEmail} invited you to join their Composer workspace.</p>` +
            `<p><a href="${params.inviteUrl}">Accept the invite</a></p>` +
            `<p>This link expires in 7 days.</p>`,
        params.inviteUrl,
    );
}

export async function sendVerificationEmail(
    to: string,
    params: { verifyUrl: string },
): Promise<void> {
    await send(
        to,
        'Confirm your email for Composer',
        `<p>Confirm your email address to finish setting up your Composer account.</p>` +
            `<p><a href="${params.verifyUrl}">Confirm email</a></p>` +
            `<p>This link expires in 24 hours.</p>`,
        params.verifyUrl,
    );
}

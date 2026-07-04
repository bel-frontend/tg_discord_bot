import { useState } from 'react';
import { changePassword, requestEmailChange } from '../api';
import { useToast } from '../toast';
import { useMe } from '../meContext';

export function AccountPanel() {
    const toast = useToast();
    const me = useMe();

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPassword, setChangingPassword] = useState(false);

    const [newEmail, setNewEmail] = useState('');
    const [emailPassword, setEmailPassword] = useState('');
    const [changingEmail, setChangingEmail] = useState(false);

    async function submitPasswordChange(e: React.FormEvent) {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast('New passwords do not match', 'error');
            return;
        }
        setChangingPassword(true);
        try {
            await changePassword(currentPassword, newPassword);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            toast('Password updated', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setChangingPassword(false);
        }
    }

    async function submitEmailChange(e: React.FormEvent) {
        e.preventDefault();
        setChangingEmail(true);
        try {
            await requestEmailChange(newEmail, emailPassword);
            setNewEmail('');
            setEmailPassword('');
            toast('Check your new email inbox to confirm the change', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setChangingEmail(false);
        }
    }

    return (
        <>
            <section className="resource-panel">
                <h2>Change password</h2>
                <p className="muted">
                    Signed in as {me?.user.email ?? ''}.
                </p>
                <form className="settings-form" onSubmit={submitPasswordChange}>
                    <div className="settings-form-fields">
                        <label>
                            <span>Current password</span>
                            <input
                                type="password"
                                autoComplete="current-password"
                                required
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>New password</span>
                            <input
                                type="password"
                                autoComplete="new-password"
                                minLength={6}
                                required
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>Confirm new password</span>
                            <input
                                type="password"
                                autoComplete="new-password"
                                minLength={6}
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </label>
                    </div>
                    <div className="settings-form-actions">
                        <button className="btn primary" disabled={changingPassword}>
                            Update password
                        </button>
                    </div>
                </form>
            </section>

            <section className="resource-panel">
                <h2>Change email</h2>
                <p className="muted">
                    We'll send a confirmation link to the new address before
                    it takes effect.
                </p>
                <form className="settings-form" onSubmit={submitEmailChange}>
                    <div className="settings-form-fields">
                        <label>
                            <span>New email</span>
                            <input
                                type="email"
                                autoComplete="email"
                                required
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>Current password</span>
                            <input
                                type="password"
                                autoComplete="current-password"
                                required
                                value={emailPassword}
                                onChange={(e) => setEmailPassword(e.target.value)}
                            />
                        </label>
                    </div>
                    <div className="settings-form-actions">
                        <button className="btn primary" disabled={changingEmail}>
                            Send confirmation link
                        </button>
                    </div>
                </form>
            </section>
        </>
    );
}

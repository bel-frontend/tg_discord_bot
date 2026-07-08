import { GripVertical, Pin, PinOff } from 'lucide-react';
import type { ChannelOption } from '../../../../shared/types';
import { channelOptionKey } from './channelKey';
import styles from './ChannelPicker.module.scss';

interface Props {
    channel: ChannelOption;
    icon: string;
    checked: boolean;
    pinned: boolean;
    dragging: boolean;
    onToggleSelect: (channel: ChannelOption) => void;
    onTogglePinned: (key: string) => void;
    onDragStart: (key: string) => void;
    onDragEnd: () => void;
}

export function ChannelRow({
    channel,
    icon,
    checked,
    pinned,
    dragging,
    onToggleSelect,
    onTogglePinned,
    onDragStart,
    onDragEnd,
}: Props) {
    const key = channelOptionKey(channel);
    const PinIcon = pinned ? PinOff : Pin;

    return (
        <div
            className={`${styles.row} ${checked ? styles.rowSelected : ''} ${dragging ? styles.dragging : ''}`}
            draggable
            onDragStart={(e) => {
                e.dataTransfer?.setData('text/plain', key);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                onDragStart(key);
            }}
            onDragEnd={onDragEnd}
        >
            <GripVertical size={12} className={styles.grip} />
            <label className={styles.rowLabel}>
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleSelect(channel)}
                />
                <span className={styles.rowIcon}>{icon}</span>
                <span className={styles.rowName}>{channel.name}</span>
            </label>
            <button
                type="button"
                className={styles.iconBtn}
                title={pinned ? 'Unpin channel' : 'Pin channel'}
                aria-label={`${pinned ? 'Unpin' : 'Pin'} ${channel.name}`}
                onClick={() => onTogglePinned(key)}
            >
                <PinIcon size={14} strokeWidth={2.4} />
            </button>
        </div>
    );
}

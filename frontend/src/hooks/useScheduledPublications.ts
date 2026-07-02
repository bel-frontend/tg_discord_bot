import { useCallback, useState } from 'react';
import {
    cancelScheduledPublication,
    fetchScheduledPublications,
} from '../api';
import type { ScheduledPublication } from '../../../shared/types';

export function useScheduledPublications() {
    const [scheduledPublications, setScheduledPublications] = useState<
        ScheduledPublication[]
    >([]);

    const loadScheduledPublications = useCallback(async () => {
        setScheduledPublications(await fetchScheduledPublications());
    }, []);

    const cancel = useCallback(async (id: string) => {
        const updated = await cancelScheduledPublication(id);
        setScheduledPublications((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
        );
        return updated;
    }, []);

    return {
        scheduledPublications,
        loadScheduledPublications,
        cancelScheduledPublication: cancel,
    };
}

import { useCallback, useState } from 'react';
import {
    cancelScheduledPublication,
    fetchPublications,
    fetchScheduledPublications,
} from '../api';
import type {
    Publication,
    ScheduledPublication,
} from '../../../shared/types';

export function useScheduledPublications() {
    const [scheduledPublications, setScheduledPublications] = useState<
        ScheduledPublication[]
    >([]);
    const [publicationArchive, setPublicationArchive] = useState<
        Publication[]
    >([]);

    const loadScheduledPublications = useCallback(async () => {
        const [scheduled, archive] = await Promise.all([
            fetchScheduledPublications(),
            fetchPublications(),
        ]);
        setScheduledPublications(scheduled);
        setPublicationArchive(archive);
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
        publicationArchive,
        loadScheduledPublications,
        cancelScheduledPublication: cancel,
    };
}

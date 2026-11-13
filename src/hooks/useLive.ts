import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import type { Query, DocumentData } from 'firebase/firestore';
import { errorMessage } from '../services/errors';
export function useLive<T>(key: string, build: () => Query<DocumentData> | null) {
  const [state, setState] = useState<{
    key: string;
    items: T[];
    loading: boolean;
    error: string;
    cached: boolean;
  }>({ key: '', items: [], loading: true, error: '', cached: false });
  useEffect(() => {
    const q = build();
    if (!q) return;
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        // Do not expose optimistic membership before its rules-authorized server commit.
        if (snap.metadata.hasPendingWrites) return;
        setState({
          key,
          items: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T),
          loading: snap.metadata.fromCache && snap.empty,
          error: '',
          cached: snap.metadata.fromCache,
        });
      },
      (e) => setState({ key, items: [], loading: false, error: errorMessage(e), cached: false }),
    );
    // The key includes every query parameter; callers create query objects lazily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key
    ? state
    : { key, items: [] as T[], loading: !!key, error: '', cached: true };
}

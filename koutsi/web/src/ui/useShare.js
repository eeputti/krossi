// useShare — share a link with native share sheet or clipboard, with toast feedback.
//   const shareLink = useShare();  shareLink({ title, text, url })
import { useCallback } from 'react';
import { share } from './effects.js';
import { useToast } from './Toast.jsx';

export function useShare() {
  const toast = useToast();
  return useCallback(async (payload) => {
    const result = await share(payload);
    if (result === 'copied') toast('Linkki kopioitu leikepöydälle', { icon: 'link' });
    else if (result === 'failed') toast('Linkin kopiointi ei onnistunut — kopioi se osoiteriviltä.', { tone: 'error' });
    return result;
  }, [toast]);
}

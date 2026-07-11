import { useState, useEffect } from 'react';

export function useSettings() {
    const [exportDir, setExportDir] = useState(() => localStorage.getItem('clipforge_exportDir') || 'D:\\YT Shorts');
    const [shortsFormat, setShortsFormat] = useState(() => localStorage.getItem('clipforge_shortsFormat') || 'vertical_blurred');
    const [durationPref, setDurationPref] = useState(() => localStorage.getItem('clipforge_durationPref') || 'dynamic');
    const [mergeClips, setMergeClips] = useState(() => localStorage.getItem('clipforge_mergeClips') === 'true');
    const [cpuFriendly, setCpuFriendly] = useState(() => localStorage.getItem('clipforge_cpuFriendly') === 'true');
    const [autoCaptions, setAutoCaptions] = useState(() => localStorage.getItem('clipforge_autoCaptions') === 'true');
    const [quality4k, setQuality4k] = useState(() => localStorage.getItem('clipforge_quality4k') === 'true');
    const [manualMode, setManualMode] = useState(false);

    // Sync all persistent settings to LocalStorage in one effect
    useEffect(() => {
        localStorage.setItem('clipforge_mergeClips', mergeClips);
        localStorage.setItem('clipforge_durationPref', durationPref);
        localStorage.setItem('clipforge_exportDir', exportDir);
        localStorage.setItem('clipforge_shortsFormat', shortsFormat);
        localStorage.setItem('clipforge_cpuFriendly', cpuFriendly);
        localStorage.setItem('clipforge_autoCaptions', autoCaptions);
        localStorage.setItem('clipforge_quality4k', quality4k);
    }, [mergeClips, durationPref, exportDir, shortsFormat, cpuFriendly, autoCaptions, quality4k]);

    return {
        exportDir,
        setExportDir,
        shortsFormat,
        setShortsFormat,
        durationPref,
        setDurationPref,
        mergeClips,
        setMergeClips,
        cpuFriendly,
        setCpuFriendly,
        autoCaptions,
        setAutoCaptions,
        quality4k,
        setQuality4k,
        manualMode,
        setManualMode,
    };
}

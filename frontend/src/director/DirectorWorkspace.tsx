import CompactDirectorPanel from './CompactDirectorPanel';
import DirectorAuthGate from './DirectorAuthGate';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <CompactDirectorPanel />
    </DirectorAuthGate>
  );
}

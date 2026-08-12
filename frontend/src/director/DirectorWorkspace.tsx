import DirectorAccessSettingsDock from './DirectorAccessSettingsDock';
import DirectorAuthGate from './DirectorAuthGate';
import PremiumDirectorPanel from './PremiumDirectorPanel';
import SyrveIntegrationDock from './SyrveIntegrationDock';
import TelegramStaffInvitePanel from '../staff/TelegramStaffInvitePanel';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <PremiumDirectorPanel />
      <TelegramStaffInvitePanel audience="director" />
      <DirectorAccessSettingsDock />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}

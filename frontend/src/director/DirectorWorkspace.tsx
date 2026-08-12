import DirectorAccessSettingsDock from './DirectorAccessSettingsDock';
import DirectorAuthGate from './DirectorAuthGate';
import DirectorSiteControlsDock from './DirectorSiteControlsDock';
import PremiumDirectorPanel from './PremiumDirectorPanel';
import SyrveIntegrationDock from './SyrveIntegrationDock';
import TelegramStaffInvitePanel from '../staff/TelegramStaffInvitePanel';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <PremiumDirectorPanel />
      <DirectorSiteControlsDock />
      <TelegramStaffInvitePanel audience="director" />
      <DirectorAccessSettingsDock />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}
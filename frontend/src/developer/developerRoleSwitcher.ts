export const DEVELOPER_ROLE_SWITCHER_PATH = '/__dev/roles';

export function isDeveloperRoleSwitcherPath(pathname: string) {
  return pathname === DEVELOPER_ROLE_SWITCHER_PATH;
}

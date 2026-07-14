import { IsIn, IsOptional } from 'class-validator';

export type ThemeMode = 'day' | 'night' | 'holiday';
export type ThemeHolidayKey =
  | 'new-year'
  | 'christmas'
  | 'valentines'
  | 'easter'
  | 'halloween'
  | 'march-8';

export class UpdateThemeDto {
  @IsIn(['day', 'night', 'holiday'])
  siteMode: ThemeMode;

  @IsOptional()
  @IsIn([
    'new-year',
    'christmas',
    'valentines',
    'easter',
    'halloween',
    'march-8',
    null,
  ])
  holidayKey?: ThemeHolidayKey | null;
}

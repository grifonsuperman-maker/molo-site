export type DirectorNoticeDestination = 'reviews' | null;

export function directorNoticeDestination(noticeId: string): DirectorNoticeDestination {
  return noticeId.startsWith('reviews:') ? 'reviews' : null;
}

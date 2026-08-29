# iPhone admin phone-link implementation guard

Temporary implementation note for this PR only. Remove this file before the PR is ready.

Required change:
- In `frontend/src/guest/GuestApp.tsx`, replace the three visible `Зателефонувати Адміністратору/адміністратору` controls that currently call `callAdmin()` with real native `<a href={...}>` `tel:` links when a restaurant phone exists.
- Preserve phone source priority: `bookingStatus?.restaurantPhone || restaurant?.phone`.
- Preserve existing Ukrainian labels and CSS classes/visual layout.
- When no phone exists, preserve the alert `Телефон адміністратора ще не додано.` and do not navigate.
- Remove the old `window.location.href = `tel:${phone}`` path so iOS Telegram receives a direct user-initiated `tel:` anchor navigation.
- Add a focused frontend regression test proving the call controls use native `tel:` anchors and the old JS location assignment is absent; wire it into the existing frontend test command.
- Do not change fullscreen, viewport, maps/SVG/coordinates/table numbers/click zones/photos/image paths, SitePhotoController, role switch, Waiter behavior, Telegram callback permissions, DB schema, or polling 15 seconds.

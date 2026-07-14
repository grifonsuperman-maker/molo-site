import { useEffect, useState } from 'react';

import { restaurantApi } from '../api/restaurant';
import type { Restaurant, SiteMode } from '../api/types';

const TITLE_ROTATION_MS = 20 * 60 * 1000;
const TITLE_STORAGE_KEY = 'molo_title_rotation_v1';

const TITLE_IMAGES = [
  '/hero-bg.jpg',
  '/maps/title/title-02.png',
  '/maps/title/title-03.png',
  '/maps/title/title-04.png',
  '/maps/title/title-05.png',
  '/maps/title/title-06.png',
];

const DAY_TO_NIGHT: Record<string, string> = {
  '/maps/territory-bg.png': '/maps/themes/night/territory.png',
  '/maps/waterfront-bg.png': '/maps/themes/night/waterfront.png',
  '/maps/hall-bg-numbered.png': '/maps/themes/night/hall.png',
  '/maps/canopy-day-numbered.png': '/maps/themes/night/canopy.png',
  '/maps/gazebo-day-numbered.png': '/maps/themes/night/gazebo.png',
  '/maps/rotang-day-numbered.png': '/maps/themes/night/rotang.png',
  '/maps/embankment-day-numbered.png': '/maps/themes/night/embankment.png',
  '/maps/glass-gazebo-day-numbered.png': '/maps/themes/night/glass-gazebo.png',
  '/maps/water-gazebo-day-numbered.png': '/maps/themes/night/water-gazebo.png',
};

const NIGHT_TO_DAY = Object.fromEntries(
  Object.entries(DAY_TO_NIGHT).map(([day, night]) => [night, day]),
) as Record<string, string>;

function unwrapRestaurant(value: unknown): Restaurant | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Restaurant | { data?: Restaurant };
  return 'data' in payload && payload.data ? payload.data : (payload as Restaurant);
}

function imagePath(value: string | null) {
  if (!value) return '';

  try {
    return new URL(value, window.location.origin).pathname;
  } catch {
    return value;
  }
}

function chooseTitleImage() {
  const bucket = Math.floor(Date.now() / TITLE_ROTATION_MS);
  let previousIndex: number | null = null;

  try {
    const saved = JSON.parse(localStorage.getItem(TITLE_STORAGE_KEY) || 'null') as {
      bucket?: number;
      index?: number;
    } | null;

    if (
      saved &&
      saved.bucket === bucket &&
      Number.isInteger(saved.index) &&
      Number(saved.index) >= 0 &&
      Number(saved.index) < TITLE_IMAGES.length
    ) {
      return TITLE_IMAGES[Number(saved.index)];
    }

    if (saved && Number.isInteger(saved.index)) {
      previousIndex = Number(saved.index);
    }
  } catch {
    previousIndex = null;
  }

  const availableIndexes = TITLE_IMAGES.map((_, index) => index).filter(
    (index) => index !== previousIndex,
  );
  const index =
    availableIndexes[Math.floor(Math.random() * availableIndexes.length)] ?? 0;

  try {
    localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify({ bucket, index }));
  } catch {
    // Сайт продовжить працювати навіть без localStorage.
  }

  return TITLE_IMAGES[index];
}

function applyPhotos(siteMode: SiteMode, titleImage: string) {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
  let titleVisible = false;

  images.forEach((image) => {
    const currentPath = imagePath(image.getAttribute('src'));
    const isTitle =
      image.dataset.moloTitle === 'true' || TITLE_IMAGES.includes(currentPath);

    if (isTitle) {
      image.dataset.moloTitle = 'true';
      const titleSection = image.closest('section');

      if (titleSection) {
        titleSection.classList.add('molo-title-screen');
        titleVisible = true;
      }

      if (currentPath !== titleImage) {
        image.setAttribute('src', titleImage);
      }

      return;
    }

    const storedDayPath = image.dataset.moloDaySrc || '';
    const dayPath =
      storedDayPath ||
      NIGHT_TO_DAY[currentPath] ||
      (DAY_TO_NIGHT[currentPath] ? currentPath : '');

    if (!dayPath) return;

    image.dataset.moloDaySrc = dayPath;
    const nextPath = siteMode === 'night' ? DAY_TO_NIGHT[dayPath] : dayPath;

    if (nextPath && currentPath !== nextPath) {
      image.setAttribute('src', nextPath);
    }
  });

  document.body.classList.toggle('molo-title-visible', titleVisible);
}

export default function SitePhotoController() {
  const [siteMode, setSiteMode] = useState<SiteMode>('day');
  const [titleImage, setTitleImage] = useState(() => chooseTitleImage());

  useEffect(() => {
    let stopped = false;

    const refreshMode = () => {
      restaurantApi
        .get()
        .then((response) => {
          const restaurant = unwrapRestaurant(response);
          if (!stopped) setSiteMode(restaurant?.siteMode || 'day');
        })
        .catch(() => {});
    };

    refreshMode();
    const timer = window.setInterval(refreshMode, 15_000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let intervalId: number | null = null;
    const delay = TITLE_ROTATION_MS - (Date.now() % TITLE_ROTATION_MS) + 100;

    const timeoutId = window.setTimeout(() => {
      setTitleImage(chooseTitleImage());
      intervalId = window.setInterval(() => {
        setTitleImage(chooseTitleImage());
      }, TITLE_ROTATION_MS);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const update = () => applyPhotos(siteMode, titleImage);
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    return () => {
      observer.disconnect();
      document.body.classList.remove('molo-title-visible');
    };
  }, [siteMode, titleImage]);

  return (
    <style>{`
      .molo-site-mode-badge {
        display: none !important;
      }

      .molo-title-screen .molo-bg {
        filter: none !important;
      }

      .molo-title-screen .molo-mode-overlay {
        background: linear-gradient(to bottom, rgba(0,0,0,.25), rgba(0,0,0,.25), rgba(0,0,0,.8)) !important;
      }

      body.molo-title-visible .molo-holiday-lights {
        display: none !important;
      }
    `}</style>
  );
}

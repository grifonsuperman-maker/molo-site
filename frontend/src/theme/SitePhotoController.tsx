import { useEffect, useState } from 'react';

import { restaurantApi } from '../api/restaurant';
import type { Restaurant, SiteMode } from '../api/types';

const TITLE_ROTATION_MS = 20 * 60 * 1000;
const TITLE_SYNC_MS = 30 * 1000;
const TITLE_STORAGE_KEY = 'molo_title_rotation_v2';

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

type TitleRotationState = {
  bucket: number;
  index: number;
};

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

function titleBucket() {
  return Math.floor(Date.now() / TITLE_ROTATION_MS);
}

function readTitleState(): TitleRotationState | null {
  try {
    const saved = JSON.parse(
      localStorage.getItem(TITLE_STORAGE_KEY) || 'null',
    ) as Partial<TitleRotationState> | null;

    if (
      !saved ||
      !Number.isInteger(saved.bucket) ||
      !Number.isInteger(saved.index) ||
      Number(saved.index) < 0 ||
      Number(saved.index) >= TITLE_IMAGES.length
    ) {
      return null;
    }

    return {
      bucket: Number(saved.bucket),
      index: Number(saved.index),
    };
  } catch {
    return null;
  }
}

function writeTitleState(state: TitleRotationState) {
  try {
    localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function seededRandom(seed: number) {
  let value = seed >>> 0;

  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function fallbackTitleIndex(bucket: number) {
  const count = TITLE_IMAGES.length;
  const cycle = Math.floor(bucket / count);
  const position = ((bucket % count) + count) % count;

  const createPermutation = (cycleNumber: number) => {
    const values = TITLE_IMAGES.map((_, index) => index);
    const random = seededRandom(cycleNumber + 0x4d4f4c4f);

    for (let index = values.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }

    return values;
  };

  const current = createPermutation(cycle);

  if (position === 0 && cycle > 0) {
    const previous = createPermutation(cycle - 1);
    const previousLast = previous[previous.length - 1];

    if (current[0] === previousLast && current.length > 1) {
      [current[0], current[1]] = [current[1], current[0]];
    }
  }

  return current[position] ?? 0;
}

function chooseTitleImage() {
  const bucket = titleBucket();
  const saved = readTitleState();

  if (saved?.bucket === bucket) {
    return TITLE_IMAGES[saved.index];
  }

  const previousIndex = saved?.index ?? fallbackTitleIndex(bucket - 1);
  const availableIndexes = TITLE_IMAGES.map((_, index) => index).filter(
    (index) => index !== previousIndex,
  );
  const randomIndex =
    availableIndexes[Math.floor(Math.random() * availableIndexes.length)] ?? 0;

  if (writeTitleState({ bucket, index: randomIndex })) {
    return TITLE_IMAGES[randomIndex];
  }

  return TITLE_IMAGES[fallbackTitleIndex(bucket)];
}

function preloadImages() {
  const paths = [...TITLE_IMAGES, ...Object.values(DAY_TO_NIGHT)];

  paths.forEach((path) => {
    const image = new Image();
    image.src = path;
  });
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
    preloadImages();
  }, []);

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
    const syncTitle = () => {
      const nextTitleImage = chooseTitleImage();
      setTitleImage((current) =>
        current === nextTitleImage ? current : nextTitleImage,
      );
    };

    const syncWhenVisible = () => {
      if (!document.hidden) syncTitle();
    };

    syncTitle();

    const timer = window.setInterval(syncTitle, TITLE_SYNC_MS);
    window.addEventListener('focus', syncTitle);
    window.addEventListener('pageshow', syncTitle);
    window.addEventListener('storage', syncTitle);
    document.addEventListener('visibilitychange', syncWhenVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', syncTitle);
      window.removeEventListener('pageshow', syncTitle);
      window.removeEventListener('storage', syncTitle);
      document.removeEventListener('visibilitychange', syncWhenVisible);
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

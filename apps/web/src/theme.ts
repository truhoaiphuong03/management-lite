let activeMediaQuery: MediaQueryList | null = null;
let activeMediaListener:
  | ((e: MediaQueryListEvent | MediaQueryList) => void)
  | null = null;

export function removeThemeListener(): void {
  if (activeMediaQuery && activeMediaListener) {
    if (typeof activeMediaQuery.removeEventListener === 'function') {
      activeMediaQuery.removeEventListener('change', activeMediaListener);
    } else {
      const legacyMq = activeMediaQuery as {
        removeListener?: (
          listener: (e: MediaQueryListEvent | MediaQueryList) => void,
        ) => void;
      };
      if (typeof legacyMq.removeListener === 'function') {
        legacyMq.removeListener(activeMediaListener);
      }
    }
  }
  activeMediaQuery = null;
  activeMediaListener = null;
}

export function applyTheme(selectedTheme: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', selectedTheme);

  // Clean up any existing system theme listener before applying new state
  removeThemeListener();

  if (selectedTheme === 'light') {
    root.style.colorScheme = 'light';
    if (document.body) {
      document.body.style.backgroundColor = '#F8FAFC';
      document.body.style.color = '#0F172A';
    }
  } else if (selectedTheme === 'dark') {
    root.style.colorScheme = 'dark';
    if (document.body) {
      document.body.style.backgroundColor = '#0B1220';
      document.body.style.color = '#F8FAFC';
    }
  } else {
    root.style.colorScheme = 'light dark';

    const updateSystemVisuals = (matchesDark: boolean) => {
      if (document.body) {
        document.body.style.backgroundColor = matchesDark
          ? '#0B1220'
          : '#F8FAFC';
        document.body.style.color = matchesDark ? '#F8FAFC' : '#0F172A';
      }
    };

    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      activeMediaQuery = mq;
      updateSystemVisuals(mq.matches);

      activeMediaListener = (e: MediaQueryListEvent | MediaQueryList) => {
        if (
          typeof document !== 'undefined' &&
          document.documentElement.getAttribute('data-theme') === 'system'
        ) {
          const matchesDark =
            typeof e.matches === 'boolean'
              ? e.matches
              : activeMediaQuery
                ? activeMediaQuery.matches
                : false;
          updateSystemVisuals(matchesDark);
        }
      };

      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', activeMediaListener);
      } else {
        const legacyMq = mq as {
          addListener?: (
            listener: (e: MediaQueryListEvent | MediaQueryList) => void,
          ) => void;
        };
        if (typeof legacyMq.addListener === 'function') {
          legacyMq.addListener(activeMediaListener);
        }
      }
    } else if (document.body) {
      document.body.style.backgroundColor = '#0B1220';
      document.body.style.color = '#F8FAFC';
    }
  }
}

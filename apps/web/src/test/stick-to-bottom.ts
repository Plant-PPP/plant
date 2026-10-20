// use-stick-to-bottom ships ES modules only, which Jest's CommonJS run cannot
// load. Its hook follows scrolling, which a server render never does.
const ref = Object.assign(() => {}, { current: null });

export const useStickToBottom = () => ({
  scrollRef: ref,
  contentRef: ref,
  scrollToBottom: () => true,
  stopScroll: () => {},
  isAtBottom: true,
  isNearBottom: true,
  escapedFromLock: false,
});

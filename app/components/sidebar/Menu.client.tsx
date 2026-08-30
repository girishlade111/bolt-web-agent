import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { IconButton } from '~/components/ui/IconButton';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { db, deleteById, getAll, chatId, type ChatHistoryItem } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: '-260px',
    transition: { duration: 0.2, ease: cubicEasingFn },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: { duration: 0.2, ease: cubicEasingFn },
  },
} satisfies Variants;

type DialogContent = { type: 'delete'; item: ChatHistoryItem } | null;

export function Menu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ChatHistoryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        .then((list) => list.filter((item) => item.urlId && item.description))
        .then(setList)
        .catch((error) => toast.error(error.message));
    }
  }, []);

  const deleteItem = useCallback((event: React.UIEvent, item: ChatHistoryItem) => {
    event.preventDefault();
    if (db) {
      deleteById(db, item.id)
        .then(() => {
          loadEntries();
          if (chatId.get() === item.id) window.location.pathname = '/';
        })
        .catch((error) => {
          toast.error('Failed to delete conversation');
          logger.error(error);
        });
    }
  }, []);

  const closeDialog = () => setDialogContent(null);

  useEffect(() => {
    if (open) loadEntries();
  }, [open]);

  useEffect(() => {
    const enterThreshold = 40;
    const exitThreshold = 40;
    function onMouseMove(event: MouseEvent) {
      if (event.pageX < enterThreshold) setOpen(true);
      if (menuRef.current && event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold) setOpen(false);
    }
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  return (
    <motion.div
      ref={menuRef}
      initial="closed"
      animate={open ? 'open' : 'closed'}
      variants={menuVariants}
      className="flex flex-col fixed top-0 w-[260px] h-full bg-[#0d0d0d] border-r border-[#2a2a2a] z-sidebar overflow-hidden"
    >
      <div className="h-[56px] shrink-0 flex items-center px-4 border-b border-[#2a2a2a]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          width="26"
          height="26"
          className="shrink-0"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="mIconBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e1e38"/>
              <stop offset="100%" stopColor="#111120"/>
            </linearGradient>
            <linearGradient id="mAccent" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1"/>
              <stop offset="50%" stopColor="#818cf8"/>
              <stop offset="100%" stopColor="#38bdf8"/>
            </linearGradient>
            <linearGradient id="mShine" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.1"/>
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
            </linearGradient>
            <filter id="mGlow">
              <feGaussianBlur stdDeviation="1" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect width="32" height="32" rx="7" fill="url(#mIconBg)"/>
          <rect width="32" height="16" rx="7" fill="url(#mShine)"/>
          <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill="none" stroke="url(#mAccent)" strokeOpacity="0.45" strokeWidth="0.9"/>
          <g filter="url(#mGlow)">
            <rect x="5.5" y="7" width="2.8" height="13.5" rx="1" fill="url(#mAccent)"/>
            <rect x="5.5" y="17.7" width="8.5" height="2.8" rx="1" fill="url(#mAccent)"/>
          </g>
          <g filter="url(#mGlow)">
            <rect x="16.5" y="7" width="8" height="2.6" rx="0.9" fill="url(#mAccent)"/>
            <rect x="16.5" y="14.7" width="8" height="2.6" rx="0.9" fill="url(#mAccent)"/>
            <rect x="16.5" y="22.4" width="8" height="2.6" rx="0.9" fill="url(#mAccent)"/>
            <rect x="16.5" y="7" width="2.6" height="7.7" rx="0.9" fill="url(#mAccent)"/>
            <rect x="21.9" y="14.7" width="2.6" height="10.3" rx="0.9" fill="url(#mAccent)"/>
          </g>
          <circle cx="29.5" cy="29.5" r="1.2" fill="#38bdf8" opacity="0.8"/>
        </svg>
        <div className="ml-2.5">
          <div className="text-[13px] font-medium leading-none text-[#e8e8e8]">LS Build</div>
          <div className="text-[11px] text-[#8a8a8a] leading-none mt-0.5">History</div>
        </div>
        <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-full bg-[#161616] border border-[#2a2a2a] text-[#8a8a8a]">{list.length}</span>
      </div>

      <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
        <div className="p-3">
          <a
            href="/"
            className="flex items-center justify-center gap-1.5 w-full bg-[#1c1c1c] hover:bg-[#242424] border border-[#2a2a2a] rounded-[6px] px-3 py-2 text-[13px] font-medium text-[#e8e8e8] transition-colors"
          >
            <span className="i-ph:plus text-sm opacity-60" />
            New chat
          </a>
        </div>

        <div className="px-4 py-2 text-[12px] font-normal text-[#8a8a8a]">Your Chats</div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {list.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-[#5c5c5c]">No previous conversations</div>}
          <DialogRoot open={dialogContent !== null}>
            {binDates(list).map(({ category, items }) => (
              <div key={category} className="mt-3 first:mt-0">
                <div className="text-[12px] font-normal text-[#8a8a8a] px-3 py-1.5 sticky top-0 bg-[#0d0d0d]">{category}</div>
                <div className="space-y-0">
                  {items.map((item) => (
                    <HistoryItem key={item.id} item={item} onDelete={() => setDialogContent({ type: 'delete', item })} />
                  ))}
                </div>
              </div>
            ))}
            <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
              {dialogContent?.type === 'delete' && (
                <>
                  <DialogTitle>Delete Chat?</DialogTitle>
                  <DialogDescription asChild>
                    <div>
                      <p>
                        You are about to delete <strong>{dialogContent.item.description}</strong>.
                      </p>
                      <p className="mt-1">Are you sure you want to delete this chat?</p>
                    </div>
                  </DialogDescription>
                  <div className="px-5 pb-4 bg-[#161616] flex gap-2 justify-end border-t border-[#2a2a2a] mt-3 pt-3">
                    <DialogButton type="secondary" onClick={closeDialog}>
                      Cancel
                    </DialogButton>
                    <DialogButton
                      type="danger"
                      onClick={(event) => {
                        deleteItem(event, dialogContent.item);
                        closeDialog();
                      }}
                    >
                      Delete
                    </DialogButton>
                  </div>
                </>
              )}
            </Dialog>
          </DialogRoot>
        </div>

        <div className="border-t border-[#2a2a2a] p-3 flex items-center justify-between bg-[#0d0d0d]">
          <span className="text-[11px] text-[#5c5c5c]">LS Build</span>
          <ThemeSwitch />
        </div>
      </div>
    </motion.div>
  );
}

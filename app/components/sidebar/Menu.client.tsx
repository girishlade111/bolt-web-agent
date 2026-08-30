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
    left: '-150px',
    transition: {
      duration: 0.24,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.24,
      ease: cubicEasingFn,
    },
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
          if (chatId.get() === item.id) {
            window.location.pathname = '/';
          }
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
      className="flex flex-col side-menu fixed top-0 w-[360px] h-full bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 z-sidebar shadow-[0_16px_48px_rgba(15,23,42,0.08),0_4px_16px_rgba(15,23,42,0.04)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45)] text-sm overflow-hidden"
    >
      {/* Header spacer */}
      <div className="h-[56px] shrink-0 flex items-center px-5 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-600 to-violet-600 flex items-center justify-center shadow-md">
            <span className="text-white font-black text-xs tracking-tighter">LS</span>
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight leading-none text-slate-900 dark:text-white">LS Build</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-none">History</div>
          </div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {list.length}
        </span>
      </div>

      <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
        <div className="p-4">
          <a
            href="/"
            className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-accent-600 to-violet-600 hover:from-accent-500 hover:to-violet-500 text-white rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg shadow-accent-500/20 hover:shadow-accent-500/30 hover:scale-[1.01] active:scale-[0.99] transition-all"
          >
            <span className="i-ph:plus-bold text-sm" />
            New Project
          </a>
          <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-2">Start a new build — LS Build scaffolds instantly</p>
        </div>

        <div className="px-5 py-2 flex items-center justify-between">
          <span className="text-xs font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">Recent builds</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">{list.length > 0 ? `${list.length} projects` : ''}</span>
        </div>

        <div className="flex-1 overflow-y-auto pl-4 pr-3 pb-4 custom-scrollbar">
          {list.length === 0 && (
            <div className="mx-2 mt-2 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mx-auto mb-3 shadow-sm">
                <span className="i-ph:clock-counter-clockwise text-slate-400 text-lg" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No builds yet</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Your conversation history will appear here. Start by describing what you want to build.</p>
            </div>
          )}
          <DialogRoot open={dialogContent !== null}>
            {binDates(list).map(({ category, items }) => (
              <div key={category} className="mt-4 first:mt-0 space-y-1">
                <div className="text-[11px] font-bold tracking-widest uppercase text-slate-400 dark:text-slate-500 sticky top-0 z-1 bg-white dark:bg-slate-950 pl-2 py-1.5">
                  {category}
                </div>
                {items.map((item) => (
                  <HistoryItem key={item.id} item={item} onDelete={() => setDialogContent({ type: 'delete', item })} />
                ))}
              </div>
            ))}
            <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
              {dialogContent?.type === 'delete' && (
                <>
                  <DialogTitle>Delete build?</DialogTitle>
                  <DialogDescription asChild>
                    <div>
                      <p>
                        You are about to delete <strong>{dialogContent.item.description}</strong>.
                      </p>
                      <p className="mt-1">This action cannot be undone.</p>
                    </div>
                  </DialogDescription>
                  <div className="px-5 pb-4 bg-white dark:bg-slate-900 flex gap-2 justify-end">
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

        <div className="border-t border-slate-100 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="i-ph:buildings text-sm" />
              LS Build Enterprise
            </div>
            <ThemeSwitch className="ml-auto" />
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 leading-relaxed">Enterprise-grade AI builder. WebContainers • Secure • Deploy anywhere.</p>
        </div>
      </div>
    </motion.div>
  );
}

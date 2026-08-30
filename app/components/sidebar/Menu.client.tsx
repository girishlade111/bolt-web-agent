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
        <div className="w-7 h-7 rounded-[6px] bg-[#161616] border border-[#2a2a2a] flex items-center justify-center">
          <span className="text-[11px] font-semibold text-[#e8e8e8]">LS</span>
        </div>
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

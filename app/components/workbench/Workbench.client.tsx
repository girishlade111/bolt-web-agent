import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { isMobile } from '~/utils/mobile';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: { value: 'code', text: 'Code' },
  right: { value: 'preview', text: 'Preview' },
};

const workbenchVariants = {
  closed: { width: 0, transition: { duration: 0.2, ease: cubicEasingFn } },
  open: { width: 'var(--workbench-width)', transition: { duration: 0.2, ease: cubicEasingFn } },
} satisfies Variants;

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);

  const setSelectedView = (view: WorkbenchViewType) => workbenchStore.currentView.set(view);

  useEffect(() => {
    if (hasPreview) setSelectedView('preview');
  }, [hasPreview]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => toast.error('Failed to update file content'));
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  return (
    chatStarted && (
      <motion.div initial="closed" animate={showWorkbench ? 'open' : 'closed'} variants={workbenchVariants} className="z-workbench">
        <div
          className={classNames(
            'fixed top-[56px] bottom-0 w-[var(--workbench-inner-width)] z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
            { 'left-[var(--workbench-left)]': showWorkbench, 'left-[100%]': !showWorkbench },
          )}
        >
          <div className="absolute inset-0">
            <div className="h-full flex flex-col bg-[#0d0d0d] border-l border-[#2a2a2a] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a] bg-[#0d0d0d]">
                <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                <div className="ml-auto flex items-center gap-1.5">
                  {selectedView === 'code' && (
                    <PanelHeaderButton
                      className="text-xs! px-2.5! py-1! rounded-[6px]! bg-[#1c1c1c] border border-[#2a2a2a] text-[#8a8a8a] hover:bg-[#242424] hover:text-[#e8e8e8]"
                      onClick={() => workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get())}
                    >
                      <span className="i-ph:terminal text-xs opacity-60" />
                      Terminal
                    </PanelHeaderButton>
                  )}
                  <IconButton
                    icon="i-ph:x"
                    className="rounded-[6px]! bg-[#1c1c1c] border border-[#2a2a2a] text-[#8a8a8a] hover:bg-[#242424] hover:text-[#e8e8e8]"
                    size="sm"
                    onClick={() => workbenchStore.showWorkbench.set(false)}
                  />
                </div>
              </div>
              <div className="relative flex-1 overflow-hidden bg-[#0d0d0d]">
                <View initial={{ x: selectedView === 'code' ? 0 : '-100%' }} animate={{ x: selectedView === 'code' ? 0 : '-100%' }}>
                  <EditorPanel
                    editorDocument={currentDocument}
                    isStreaming={isStreaming}
                    selectedFile={selectedFile}
                    files={files}
                    unsavedFiles={unsavedFiles}
                    onFileSelect={onFileSelect}
                    onEditorScroll={onEditorScroll}
                    onEditorChange={onEditorChange}
                    onFileSave={onFileSave}
                    onFileReset={onFileReset}
                  />
                </View>
                <View initial={{ x: selectedView === 'preview' ? 0 : '100%' }} animate={{ x: selectedView === 'preview' ? 0 : '100%' }}>
                  <Preview />
                </View>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )
  );
});

interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});

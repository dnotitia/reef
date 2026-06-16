import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteIssueDialog({
  open,
  issueId,
  isDeleting,
  onOpenChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  issueId: string;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="issue-delete-confirm"
        className="max-w-md gap-4"
      >
        <DialogHeader>
          <DialogTitle>Delete {issueId}?</DialogTitle>
          <DialogDescription>
            The issue file will be removed from the workspace vault. akb's git
            history is preserved, but the issue won't be reachable from reef.
            Use <span className="font-medium">Archive</span> instead if you
            might restore it later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isDeleting}
            data-testid="issue-delete-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={isDeleting}
            data-testid="issue-delete-confirm-btn"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { IconCertificate } from "../common/Icons";

type ConsentDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConsentDialog({
  open,
  onCancel,
  onConfirm,
}: ConsentDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog-card consent-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
      >
        <div className="dialog-header">
          <div className="dialog-header-title">
            <IconCertificate size={16} className="dialog-shield-icon" />
            <h2 id="consent-title">Authorization Required</h2>
          </div>
        </div>

        <div className="dialog-body">
          <h3 className="consent-headline">Inspect only traffic you are authorized to test</h3>
          <p className="consent-desc">
            Captured network traffic may contain sensitive information including authentication tokens, API keys, session cookies, and personal data.
          </p>
          <p className="consent-desc">
            Only inspect applications, mobile devices, and network streams that you own or have explicit authorization to monitor and test.
          </p>
        </div>

        <div className="dialog-footer">
          <button className="button button-subtle" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={onConfirm}
          >
            I understand, start capture
          </button>
        </div>
      </div>
    </div>
  );
}

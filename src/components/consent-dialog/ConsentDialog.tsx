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
      <section
        className="consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
      >
        <p className="eyebrow">Authorization required</p>
        <h2 id="consent-title">Inspect only traffic you are allowed to test</h2>
        <p>
          Captured traffic may contain passwords, tokens, cookies, and personal
          data. Only inspect applications, devices, and traffic that you own or
          are explicitly authorized to test.
        </p>
        <div className="dialog-actions">
          <button className="button" type="button" onClick={onCancel}>
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
      </section>
    </div>
  );
}

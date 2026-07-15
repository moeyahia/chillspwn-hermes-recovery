import { useState } from "react";
import { Button } from "../../design-system/components/Primitives";
import { ContextPackPanel } from "./ContextPackPanel";

export function ContextUsedDisclosure({ packId }: { packId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="os-context-used-disclosure">
      <Button
        type="button"
        variant="quiet"
        aria-expanded={open}
        aria-controls={`context-used-${packId}`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide context used" : "Context used"}
      </Button>
      {open && <div id={`context-used-${packId}`}><ContextPackPanel packId={packId} /></div>}
    </div>
  );
}

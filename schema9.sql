
.study-board {
  display: grid;
  gap: 16px;
  margin: 24px 0 12px;
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
}

.study-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.study-generator {
  display: grid;
  gap: 12px;
}

.study-generator textarea {
  width: 100%;
  min-height: 92px;
  resize: vertical;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  color: var(--ink);
  padding: 10px 12px;
  font: inherit;
}

.study-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.study-empty {
  display: grid;
  gap: 6px;
  padding: 18px;
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border: 1px dashed var(--line);
  border-radius: 12px;
  color: var(--muted);
}

.study-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.study-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--bg);
  border: 1px solid var(--line);
}

.study-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.study-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 8%, var(--surface));
  color: var(--ink);
  padding: 5px 8px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.study-pill.accent {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.study-prompt {
  margin: 0;
  color: var(--ink);
  line-height: 1.6;
}

.study-options {
  display: grid;
  gap: 8px;
}

.study-option {
  width: 100%;
  text-align: left;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 10px;
}

.study-option.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}

.study-answer-box {
  display: grid;
  gap: 8px;
  padding: 12px;
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border: 1px solid var(--line);
  border-radius: 10px;
}

.study-answer-box p {
  margin: 0;
  color: var(--ink);
  line-height: 1.6;
}

.study-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.review-filters {
  margin-bottom: 6px;
}

.workspace-card.workspace-review {
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), var(--surface));
}

@media (max-width: 640px) {
  .study-board {
    padding: 14px;
  }
}

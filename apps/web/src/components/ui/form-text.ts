// A form's dense scale, wherever it sits (a dialog, a settings card): labels,
// selects and buttons at text-xs, and fields too from md, since phones keep
// 16px inputs so iOS does not zoom.
export const FORM_TEXT =
  "[&_[data-slot=label]]:text-xs [&_[data-slot=select-trigger]]:text-xs md:[&_input]:text-xs md:[&_textarea]:text-xs";

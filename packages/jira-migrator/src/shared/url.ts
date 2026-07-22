const slashCharCode = 47;

export const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === slashCharCode) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
};

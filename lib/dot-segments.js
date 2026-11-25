'use strict'

// "." and ".." path segments, also percent-encoded or separated by a backslash
// or an encoded (back)slash, some upstreams decode those before normalizing
// (a ";" path parameter is ignored by some upstreams, e.g. "/..;/")
const DOT_SEGMENT_REGEX =
  /(?:^|[/\\]|%2f|%5c)(?:\.|%2e){1,2}(?:;[^/\\]*)?(?:[/\\]|%2f|%5c|$)/i

// the upstream would resolve dot segments, escaping the route prefix
module.exports = (url) => {
  const queryIndex = url.indexOf('?')

  return DOT_SEGMENT_REGEX.test(
    queryIndex === -1 ? url : url.slice(0, queryIndex)
  )
}

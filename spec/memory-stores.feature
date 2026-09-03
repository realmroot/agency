Feature: Memory Stores
  Memory stores are project-scoped collections of session-mounted memory files.
  They are safe control-plane resources backed by D1 and attached to sessions
  through managed memory volumes.

  @memory-stores/crud @api
  Scenario: Manage memory stores and memories
    Given a project needs reusable agent memory files
    When the user creates a memory store with a name and optional description
    And adds memories with relative paths and content
    Then the store and memories are listed within the project
    And unsafe paths, duplicate paths, and cross-project access are rejected

	  @memory-stores/session-binding @api
	  Scenario: Attach memory stores to a session as managed resources
	    Given a project has an active memory store with memories
	    When the user creates a session with a memory volume and readOnly volumeMount
    Then the session stores the memory reference in the volume and readOnly setting in the volumeMount
    And runtime materialization mounts the current memory store contents
    And callers cannot provide a memory store mount path
    And deleted or cross-project stores are rejected before runtime allocation

  @memory-stores/console @web
  Scenario: Manage and attach memory stores in the console
    Given the user opens the Memory Stores console
    When they create a store, add a memory, and create a session
    Then the store can be selected in the session form with the volumeMount readOnly setting
    And the session detail shows the attached memory store without exposing memory content in the resource summary
    And the memory store detail shows memory files in a file explorer with selected file content
